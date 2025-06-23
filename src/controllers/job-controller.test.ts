import { Request, Response, NextFunction } from 'express';
import { JobController } from './job-controller';
import database from '../services/database';
import { jobQueue } from '../services/job-queue';

// Mock dependencies
jest.mock('../services/database');
jest.mock('../services/job-queue', () => ({
  jobQueue: {
    add: jest.fn()
  }
}));
jest.mock('ioredis');

describe('JobController', () => {
  let controller: JobController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    controller = new JobController();
    
    // Setup mock request
    mockReq = {
      body: {},
      params: {},
      query: {}
    };

    // Setup mock response
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    // Setup mock next function
    mockNext = jest.fn();

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('delegateJob', () => {
    it('should successfully delegate a valid job', async () => {
      const jobContext = {
        jobId: '123',
        runId: '456',
        repository: 'test/repo',
        workflow: 'CI',
        runnerName: 'proxy-1',
        labels: ['self-hosted', 'ubuntu-latest']
      };

      mockReq.body = jobContext;
      (mockReq as unknown as { io: { to: jest.Mock; emit: jest.Mock } }).io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      // Mock database query
      (database.query as jest.Mock).mockResolvedValue([]);

      // Mock job queue
      (jobQueue.add as jest.Mock).mockResolvedValue({});

      await controller.delegateJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          delegationId: expect.any(String),
          status: 'queued'
        })
      });
    });

    it('should reject job with missing required fields', async () => {
      mockReq.body = {
        jobId: '123'
        // Missing required fields
      };

      await controller.delegateJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Missing required job context fields'
        })
      );
    });
  });

  describe('getJob', () => {
    it('should return job details when found', async () => {
      const mockJob = {
        id: 'test-id',
        github_job_id: 123,
        job_name: 'test-job',
        repository: 'test/repo',
        workflow_name: 'CI',
        status: 'running',
        labels: ['self-hosted']
      };

      mockReq.params = { id: 'test-id' };
      (database.query as jest.Mock).mockResolvedValue([mockJob]);

      await controller.getJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 'test-id',
          githubJobId: 123,
          status: 'running'
        })
      });
    });

    it('should return 404 when job not found', async () => {
      mockReq.params = { id: 'non-existent' };
      (database.query as jest.Mock).mockResolvedValue([]);

      await controller.getJob(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Job not found'
        })
      );
    });
  });

  describe('listJobs', () => {
    it('should return paginated job list', async () => {
      mockReq.query = { page: '1', limit: '10' };
      
      (database.query as jest.Mock)
        .mockResolvedValueOnce([{ count: '25' }]) // Total count
        .mockResolvedValueOnce([
          { id: '1', status: 'completed' },
          { id: '2', status: 'running' }
        ]); // Jobs

      await controller.listJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.any(Array),
        pagination: {
          page: 1,
          limit: 10,
          total: 25,
          totalPages: 3
        }
      });
    });

    it('should filter by repository', async () => {
      mockReq.query = { repository: 'test/repo' };
      
      (database.query as jest.Mock)
        .mockResolvedValueOnce([{ count: '5' }])
        .mockResolvedValueOnce([]);

      await controller.listJobs(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      // Verify repository filter was applied
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('repository = $'),
        expect.arrayContaining(['test/repo'])
      );
    });
  });

  describe('updateJobStatus', () => {
    it('should update job status successfully', async () => {
      mockReq.params = { id: 'test-id' };
      mockReq.body = { status: 'completed' };
      (mockReq as unknown as { io: { to: jest.Mock; emit: jest.Mock } }).io = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

      const mockJob = {
        id: 'test-id',
        status: 'completed',
        repository: 'test/repo'
      };

      (database.query as jest.Mock)
        .mockResolvedValueOnce([]) // Update query
        .mockResolvedValueOnce([mockJob]); // Select query

      await controller.updateJobStatus(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          id: 'test-id',
          status: 'completed'
        })
      });
    });

    it('should reject invalid status', async () => {
      mockReq.params = { id: 'test-id' };
      mockReq.body = { status: 'invalid-status' };

      await controller.updateJobStatus(
        mockReq as Request,
        mockRes as Response,
        mockNext
      );

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Invalid status'
        })
      );
    });
  });
});