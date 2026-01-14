export interface RegressionConfig {
  threshold: number      // Default regression threshold (e.g., 0.2 = 20%)
  blockThreshold?: number // Threshold for blocking CI
}

export interface RegressionResult {
  regressions: string[]
  improvements: string[]
  unchanged: string[]
  hasRegressions: boolean
  shouldBlockCI: boolean
  worstRegression?: { name: string; change: number }
  bestImprovement?: { name: string; change: number }
}
