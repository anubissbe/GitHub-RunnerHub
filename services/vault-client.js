const axios = require('axios');

class VaultClient {
    constructor(options = {}) {
        this.vaultAddr = options.addr || process.env.VAULT_ADDR || 'http://192.168.1.24:8200';
        this.vaultToken = options.token || process.env.VAULT_TOKEN;
        
        this.client = axios.create({
            baseURL: this.vaultAddr,
            headers: {
                'X-Vault-Token': this.vaultToken,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        console.log(`🔐 Vault client initialized: ${this.vaultAddr}`);
    }

    /**
     * Get secret from Vault
     */
    async getSecret(path) {
        try {
            const response = await this.client.get(`/v1/secret/data/${path}`);
            
            if (response.data && response.data.data && response.data.data.data) {
                return response.data.data.data;
            }
            
            console.warn(`⚠️ No data found at vault path: ${path}`);
            return null;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.warn(`⚠️ Vault secret not found: ${path}`);
                return null;
            }
            
            console.error(`❌ Failed to get secret from Vault (${path}):`, error.message);
            throw error;
        }
    }

    /**
     * Get GitHub secrets from Vault
     */
    async getGitHubSecrets() {
        try {
            console.log('🔍 Fetching GitHub secrets from Vault...');
            
            // Try multiple possible paths for GitHub secrets
            const possiblePaths = [
                'github',             // Main GitHub token path (confirmed in Vault)
                'github_classic_token', // Classic token path  
                'api-keys',           // Fallback path
                'github/runnerhub'    // Setup script path
            ];

            for (const path of possiblePaths) {
                const secrets = await this.getSecret(path);
                if (secrets) {
                    // Check if we have GitHub token in various formats
                    const githubToken = secrets.GITHUB_TOKEN || 
                                      secrets.github_token || 
                                      secrets.token ||
                                      secrets.GITHUB_CLASSIC_TOKEN;
                    
                    if (githubToken) {
                        console.log(`✅ Found GitHub token in Vault at path: ${path}`);
                        return {
                            token: githubToken,
                            org: secrets.GITHUB_ORG || secrets.github_org || secrets.org,
                            webhookSecret: secrets.GITHUB_WEBHOOK_SECRET || secrets.webhook_secret,
                            appId: secrets.GITHUB_APP_ID || secrets.app_id,
                            privateKey: secrets.GITHUB_PRIVATE_KEY || secrets.private_key
                        };
                    }
                }
            }
            
            console.warn('⚠️ No GitHub token found in Vault');
            return null;
        } catch (error) {
            console.error('❌ Failed to fetch GitHub secrets from Vault:', error.message);
            return null;
        }
    }

    /**
     * Test Vault connectivity
     */
    async testConnection() {
        try {
            await this.client.get('/v1/sys/health');
            console.log('✅ Vault connectivity test successful');
            return true;
        } catch (error) {
            console.error('❌ Vault connectivity test failed:', error.message);
            return false;
        }
    }

    /**
     * List available secrets (for debugging)
     */
    async listSecrets(_path = '') {
        try {
            const response = await this.client.get(`/v1/secret/metadata`, {
                params: { list: true }
            });
            
            if (response.data && response.data.data && response.data.data.keys) {
                console.log('📋 Available Vault secrets:', response.data.data.keys);
                return response.data.data.keys;
            }
            
            return [];
        } catch (error) {
            console.error('Failed to list secrets:', error.message);
            return [];
        }
    }
}

module.exports = VaultClient;