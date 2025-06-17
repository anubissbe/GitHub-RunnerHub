import React, { useState } from 'react';

interface LoginProps {
  onLogin: (token: string) => void;
}

export const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [activeTab, setActiveTab] = useState<'github' | 'admin'>('github');
  const [githubToken, setGithubToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8300';

  const handleLogin = async () => {
    setError('');
    setLoading(true);

    try {
      const body = activeTab === 'github' 
        ? { githubToken }
        : { username, password };

      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store tokens
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));

      // Call parent callback
      onLogin(data.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">GitHub RunnerHub</h1>
          <p className="text-gray-400">Sign in to access the dashboard</p>
        </div>

        <div className="bg-gray-800 rounded-lg shadow-xl p-6">
          {/* Tab Selector */}
          <div className="flex mb-6">
            <button
              onClick={() => setActiveTab('github')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-l-md transition-colors ${
                activeTab === 'github'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              GitHub Token
            </button>
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex-1 py-2 px-4 text-sm font-medium rounded-r-md transition-colors ${
                activeTab === 'admin'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Admin Login
            </button>
          </div>

          {/* Login Forms */}
          {activeTab === 'github' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                GitHub Personal Access Token
              </label>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              />
              <p className="mt-2 text-xs text-gray-400">
                Use the same token configured for your runners
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-red-900/50 border border-red-600 rounded-md">
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Login Button */}
          <button
            onClick={handleLogin}
            disabled={loading || (activeTab === 'github' ? !githubToken : !username || !password)}
            className={`w-full mt-6 py-2 px-4 rounded-md font-medium transition-colors ${
              loading || (activeTab === 'github' ? !githubToken : !username || !password)
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>

        <p className="mt-4 text-center text-sm text-gray-400">
          Need help? Check the{' '}
          <a href="https://github.com/anubissbe/GitHub-RunnerHub" className="text-orange-500 hover:text-orange-400">
            documentation
          </a>
        </p>
      </div>
    </div>
  );
};