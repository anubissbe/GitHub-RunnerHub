import { DatabaseService } from './database';

describe('DatabaseService', () => {
  it('should be a singleton', () => {
    const instance1 = DatabaseService.getInstance();
    const instance2 = DatabaseService.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should have required methods', () => {
    const db = DatabaseService.getInstance();
    expect(typeof db.query).toBe('function');
    expect(typeof db.getClient).toBe('function');
    expect(typeof db.transaction).toBe('function');
    expect(typeof db.healthCheck).toBe('function');
    expect(typeof db.close).toBe('function');
  });
});