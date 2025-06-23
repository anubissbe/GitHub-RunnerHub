export { 
  ImageOptimizer,
  type ImageOptimizationConfig,
  type BaseImageConfig,
  type OptimizationRule,
  type OptimizationCondition,
  type OptimizationAction,
  type LayerCachingConfig,
  type CompressionConfig,
  type SecurityConfig,
  type PerformanceConfig,
  type CleanupConfig,
  type OptimizedImage,
  type AppliedOptimization,
  type OptimizationImpact,
  type BuildContext,
  ImageCategory,
  OptimizationType,
  OptimizationTarget,
  OptimizationActionType,
  CachingStrategy,
  CompressionAlgorithm,
  VulnerabilityLevel,
  PruneStrategy
} from './image-optimizer';

// Convenience function to create and configure image optimizer
export function createImageOptimizer(config?: Partial<ImageOptimizationConfig>) {
  const optimizer = ImageOptimizer.getInstance();
  
  if (config) {
    optimizer.updateConfig(config);
  }
  
  return optimizer;
}

// Convenience function for quick image optimization
export async function optimizeImage(
  imageId: string, 
  options?: {
    force?: boolean;
    optimizations?: string[];
    buildContext?: BuildContext;
  }
) {
  const optimizer = ImageOptimizer.getInstance();
  return optimizer.optimizeImage(imageId, options);
}

// Convenience function to get optimization statistics
export function getOptimizationStats() {
  const optimizer = ImageOptimizer.getInstance();
  return optimizer.getOptimizationStats();
}