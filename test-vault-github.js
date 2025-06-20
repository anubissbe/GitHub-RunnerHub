const VaultClient = require('./services/vault-client');

async function testVaultGitHub() {
    console.log('🔧 Testing Vault GitHub integration...');
    console.log('VAULT_ADDR:', process.env.VAULT_ADDR);
    console.log('VAULT_TOKEN:', process.env.VAULT_TOKEN ? `${process.env.VAULT_TOKEN.substring(0, 10)}...` : 'undefined');
    
    const vault = new VaultClient();
    
    // Test basic connectivity
    console.log('\n1. Testing Vault connectivity...');
    const connected = await vault.testConnection();
    console.log('Vault connected:', connected);
    
    if (!connected) {
        console.log('❌ Vault not accessible, exiting');
        return;
    }
    
    // Try to list available secrets
    console.log('\n2. Listing available secrets...');
    const secrets = await vault.listSecrets();
    console.log('Available secrets:', secrets);
    
    // Test direct secret access
    console.log('\n3. Testing direct secret access...');
    const paths = ['github', 'github_classic_token', 'api-keys'];
    
    for (const path of paths) {
        console.log(`\nTesting path: ${path}`);
        try {
            const secret = await vault.getSecret(path);
            if (secret) {
                console.log(`✅ Found secret at ${path}:`, Object.keys(secret));
                if (secret.GITHUB_TOKEN || secret.token) {
                    const token = secret.GITHUB_TOKEN || secret.token;
                    console.log(`🔑 Token found: ${token.substring(0, 10)}...${token.substring(token.length - 4)}`);
                }
            } else {
                console.log(`⚠️ No data at ${path}`);
            }
        } catch (error) {
            console.log(`❌ Error accessing ${path}:`, error.message);
        }
    }
    
    // Test the GitHub secrets method
    console.log('\n4. Testing getGitHubSecrets method...');
    try {
        const githubSecrets = await vault.getGitHubSecrets();
        if (githubSecrets) {
            console.log('✅ GitHub secrets found:', {
                hasToken: !!githubSecrets.token,
                org: githubSecrets.org,
                tokenPreview: githubSecrets.token ? `${githubSecrets.token.substring(0, 10)}...` : 'none'
            });
        } else {
            console.log('❌ No GitHub secrets found');
        }
    } catch (error) {
        console.log('❌ Error getting GitHub secrets:', error.message);
    }
}

testVaultGitHub().catch(console.error);