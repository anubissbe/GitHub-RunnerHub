import { GitHubAPIService } from '../services/github-api';

// Extended GitHub API interface with all required methods
export interface ExtendedGitHubAPIService extends GitHubAPIService {
  createCheckRun(repository: string, data: any): Promise<{ id: number }>;
  updateCheckRun(repository: string, checkRunId: number, data: any): Promise<void>;
}

// Helper to cast GitHubAPIService to ExtendedGitHubAPIService
export function getExtendedGitHub(): ExtendedGitHubAPIService {
  return new GitHubAPIService() as unknown as ExtendedGitHubAPIService;
}