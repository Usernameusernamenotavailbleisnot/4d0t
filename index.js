const fs = require('fs').promises;
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const CryptoJS = require('crypto-js');

// Configuration
const CONFIG = {
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  delayBetweenWallets: [5000, 10000], // Random delay between 5-10 seconds
  apiBaseUrl: 'https://api.a.xyz/api',
  encryptionKey: 'wVAIZ8LK7e//7+v6rJ4LjUp1kCwNlhtgURMFVcn54yI=', // Base64 encoded key
  uuid: '5f8626fd-3342-4184-9235-41b773ceed9a', // Static UUID used for encryption
  headers: {
    'accept': 'application/json, text/plain, */*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9',
    'connection': 'keep-alive',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'origin': 'https://ai.a.xyz',
    'referer': 'https://ai.a.xyz/',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site'
  }
};

// Function to read file content and split by lines
async function readFileLines(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

// Format proxy URL based on common formats
function formatProxyUrl(proxy) {
  const parts = proxy.split(':');
  
  if (parts.length === 2) {
    return `http://${parts[0]}:${parts[1]}`;
  } else if (parts.length === 4) {
    return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  } else {
    console.warn(`Unexpected proxy format: ${proxy}. Using as is.`);
    return `http://${proxy}`;
  }
}

// Function to generate encrypted data for header
function generateEncryptedData(method, path, timestamp, uid = null) {
  // Prepare data to encrypt
  const lastFiveDigits = timestamp.toString().slice(-5);
  let dataToEncrypt = method + path + CONFIG.uuid + lastFiveDigits;
  
  // Add UID if provided (needed for profile check and check-in)
  if (uid) {
    dataToEncrypt += uid;
  }
  
  // Generate random IV (16 bytes)
  const iv = CryptoJS.lib.WordArray.random(16);
  
  // Parse the encryption key from Base64
  const key = CryptoJS.enc.Base64.parse(CONFIG.encryptionKey);
  
  // Encrypt the data using AES-CBC
  const encrypted = CryptoJS.AES.encrypt(dataToEncrypt, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  
  // Combine IV and encrypted data
  const combined = CryptoJS.lib.WordArray.create()
    .concat(iv)
    .concat(encrypted.ciphertext);
  
  // Convert to Base64
  return combined.toString(CryptoJS.enc.Base64);
}

// Login function
async function login(address, proxyUrl, retryCount = 0) {
  try {
    const timestamp = Date.now();
    const payload = {
      wallet: {
        address: address,
        walletType: "COMMON"
      }
    };
    
    // Generate encrypted data for header
    const encryptedData = generateEncryptedData('post', '/api/auth/login', timestamp);
    
    const config = {
      method: 'post',
      url: `${CONFIG.apiBaseUrl}/auth/login`,
      headers: {
        ...CONFIG.headers,
        'content-type': 'application/json;charset=UTF-8;',
        'encrypted-data': encryptedData,
        'timestamp': timestamp.toString()
      },
      data: payload
    };
    
    // Add proxy if available
    if (proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }
    
    console.log(`[Attempt ${retryCount + 1}] Login for address: ${address}`);
    const response = await axios(config);
    
    if (response.data && response.data.code === 200) {
      console.log(`✅ Login successful for address: ${address}`);
      return {
        uid: response.data.data.uid,
        authToken: response.data.data.auth_token
      };
    } else {
      console.error(`❌ Login failed for address: ${address}`, response.data);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error during login for address: ${address}: ${error.message}`);
    
    if (retryCount < CONFIG.maxRetries) {
      console.log(`🔄 Retrying login for address: ${address} (${retryCount + 1}/${CONFIG.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return login(address, proxyUrl, retryCount + 1);
    }
    
    return null;
  }
}

// Check profile function
async function checkProfile(uid, authToken, proxyUrl, retryCount = 0) {
  try {
    const timestamp = Date.now();
    
    // Generate encrypted data for header
    const encryptedData = generateEncryptedData('get', '/api/user/profile', timestamp, uid);
    
    const config = {
      method: 'get',
      url: `${CONFIG.apiBaseUrl}/user/profile?uid=${uid}&authToken=${authToken}`,
      headers: {
        ...CONFIG.headers,
        'encrypted-data': encryptedData,
        'timestamp': timestamp.toString()
      }
    };
    
    // Add proxy if available
    if (proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }
    
    console.log(`[Attempt ${retryCount + 1}] Checking profile for UID: ${uid}`);
    const response = await axios(config);
    
    if (response.data && response.data.code === 200) {
      const { total_points, today_points } = response.data.data;
      console.log(`✅ Profile check successful - Points: ${total_points} (Today: ${today_points})`);
      return { totalPoints: total_points, todayPoints: today_points };
    } else {
      console.error(`❌ Profile check failed for UID: ${uid}`, response.data);
      return null;
    }
  } catch (error) {
    console.error(`❌ Error during profile check for UID: ${uid}: ${error.message}`);
    
    if (retryCount < CONFIG.maxRetries) {
      console.log(`🔄 Retrying profile check for UID: ${uid} (${retryCount + 1}/${CONFIG.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return checkProfile(uid, authToken, proxyUrl, retryCount + 1);
    }
    
    return null;
  }
}

// Daily check-in function
async function dailyCheckin(uid, authToken, proxyUrl, retryCount = 0) {
  try {
    const timestamp = Date.now();
    
    // Generate encrypted data for header
    const encryptedData = generateEncryptedData('get', '/api/user/daily/checkin', timestamp, uid);
    
    const config = {
      method: 'get',
      url: `${CONFIG.apiBaseUrl}/user/daily/checkin?uid=${uid}&authToken=${authToken}`,
      headers: {
        ...CONFIG.headers,
        'encrypted-data': encryptedData,
        'timestamp': timestamp.toString()
      }
    };
    
    // Add proxy if available
    if (proxyUrl) {
      config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    }
    
    console.log(`[Attempt ${retryCount + 1}] Performing daily check-in for UID: ${uid}`);
    const response = await axios(config);
    
    // Check for successful check-in OR already checked in today
    if (response.data && (response.data.code === 200 || 
        (response.data.code === 1007 && response.data.message.includes('Have signed in today')))) {
      
      if (response.data.code === 200) {
        console.log(`✅ Daily check-in successful: ${response.data.data}`);
      } else {
        console.log(`✅ Already checked in today for UID: ${uid}`);
      }
      
      return true;
    } else {
      console.error(`❌ Daily check-in failed for UID: ${uid}`, response.data);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error during daily check-in for UID: ${uid}: ${error.message}`);
    
    if (retryCount < CONFIG.maxRetries) {
      console.log(`🔄 Retrying daily check-in for UID: ${uid} (${retryCount + 1}/${CONFIG.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return dailyCheckin(uid, authToken, proxyUrl, retryCount + 1);
    }
    
    return false;
  }
}

// Get random delay between min and max milliseconds
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// Process a single wallet with all steps
async function processWallet(address, proxyUrl) {
  console.log(`\n🔹 Processing wallet: ${address} with proxy: ${proxyUrl || 'none'}`);
  
  // Step 1: Login
  const loginResult = await login(address, proxyUrl);
  if (!loginResult) {
    console.error(`❌ Failed to login for address: ${address}`);
    return false;
  }
  
  const { uid, authToken } = loginResult;
  
  // Add a small delay between API calls
  await new Promise(resolve => setTimeout(resolve, getRandomDelay(1000, 3000)));
  
  // Step 2: Check profile
  const profileResult = await checkProfile(uid, authToken, proxyUrl);
  if (!profileResult) {
    console.error(`❌ Failed to check profile for address: ${address}`);
    return false;
  }
  
  // Add a small delay between API calls
  await new Promise(resolve => setTimeout(resolve, getRandomDelay(1000, 3000)));
  
  // Step 3: Daily check-in
  const checkinResult = await dailyCheckin(uid, authToken, proxyUrl);
  if (!checkinResult) {
    console.error(`❌ Failed to perform daily check-in for address: ${address}`);
    return false;
  }
  
  console.log(`✅ Successfully processed wallet: ${address}`);
  return true;
}

// Main function to process all wallets
async function processWallets() {
  try {
    // Read addresses and proxies from files
    const addresses = await readFileLines('./address.txt');
    const proxies = await readFileLines('./proxy.txt');
    
    if (addresses.length === 0) {
      throw new Error('No addresses found in address.txt');
    }
    
    console.log(`📋 Found ${addresses.length} addresses and ${proxies.length} proxies`);
    
    // Process each wallet
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i].trim();
      
      // If address is empty, skip
      if (!address) {
        console.log(`⚠️ Skipping empty address at index ${i}`);
        continue;
      }
      
      // Get matching proxy or null if none available
      const proxy = i < proxies.length ? proxies[i].trim() : null;
      const proxyUrl = proxy ? formatProxyUrl(proxy) : null;
      
      // Process this wallet
      const result = await processWallet(address, proxyUrl);
      
      // Update counters
      if (result) {
        successCount++;
      } else {
        failCount++;
      }
      
      // Add a delay before processing the next wallet (if any)
      if (i < addresses.length - 1) {
        const delay = getRandomDelay(CONFIG.delayBetweenWallets[0], CONFIG.delayBetweenWallets[1]);
        console.log(`⏳ Waiting ${Math.round(delay/1000)} seconds before processing the next wallet...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    console.log(`\n📊 Processing completed: ${successCount} successful, ${failCount} failed`);
  } catch (error) {
    console.error(`❌ Error processing wallets: ${error.message}`);
  }
}

// Function to run the process and schedule the next run
async function runAndSchedule() {
  try {
    // Display start time
    console.log(`\n🚀 Starting daily check-in process at ${new Date().toISOString()}`);
    
    // Process all wallets
    await processWallets();
    
    // Display finish time
    console.log(`🏁 Finished daily check-in process at ${new Date().toISOString()}`);
    
    // Calculate next run time (24.5 hours = 24 hours and 30 minutes from now)
    const nextRunDelay = 24 * 60 * 60 * 1000 + 30 * 60 * 1000; // 24.5 hours in milliseconds
    const nextRunTime = new Date(Date.now() + nextRunDelay);
    
    console.log(`\n⏰ Next run scheduled for: ${nextRunTime.toISOString()} (in 24.5 hours)`);
    console.log(`💡 Keeping script running. Press Ctrl+C to exit.`);
    
    // Schedule next run
    setTimeout(runAndSchedule, nextRunDelay);
  } catch (error) {
    console.error(`💥 Fatal error: ${error.message}`);
    console.log(`⚠️ Scheduling next attempt in 1 hour due to error.`);
    
    // If there was an error, try again in 1 hour
    setTimeout(runAndSchedule, 60 * 60 * 1000);
  }
}

// Start the first run
runAndSchedule();
