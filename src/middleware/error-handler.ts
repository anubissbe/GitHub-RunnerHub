import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('ErrorHandler');

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error('Non-operational error', { 
        error: err.message, 
        stack: err.stack,
        url: req.url,
        method: req.method
      });
    }

    res.status(err.statusCode).json({
      success: false,
      error: err.message
    });
  } else {
    logger.error('Unexpected error', { 
      error: err.message, 
      stack: err.stack,
      url: req.url,
      method: req.method
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};