/** Brand marks for the masthead links. Both draw in `currentColor` and size to
 *  their `className` (set a height; width follows the aspect ratio). */

/** GitHub octocat. */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

/** The full Neon logo (logomark + wordmark) from neon.com/brand, mono variant. */
export function NeonLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 157 45" className={className} fill="currentColor" aria-hidden="true">
      <path d="M43.9855 0.0123174V44L26.9857 29.2514V44H0.417969V0L43.9855 0.0123174ZM5.75846 38.6595H21.6452V17.5326L38.6453 32.5729V5.35124L5.75846 5.34181V38.6595Z" />
      <path d="M79.0696 35.7042L62.1559 20.7349V35.4106H56.8359V9.06775L73.7497 24.037V9.36126H79.0696V35.7042ZM84.9261 35.4106V9.36126H100.849V14.6078H90.2461V19.7443H98.6479V24.8808H90.2461V30.1641H100.849V35.4106H84.9261ZM117.319 35.7042C109.944 35.7042 104 29.7605 104 22.386C104 15.0114 109.944 9.06775 117.319 9.06775C124.693 9.06775 130.637 15.0114 130.637 22.386C130.637 29.7605 124.693 35.7042 117.319 35.7042ZM117.319 30.5677C121.868 30.5677 125.28 26.8987 125.28 22.386C125.28 17.8732 121.868 14.2042 117.319 14.2042C112.769 14.2042 109.357 17.8732 109.357 22.386C109.357 26.8987 112.769 30.5677 117.319 30.5677ZM156.492 35.7042L139.578 20.7349V35.4106H134.258V9.06775L151.172 24.037V9.36126H156.492V35.7042Z" />
    </svg>
  )
}

/** The Vercel triangle from vercel.com/design/brand. */
export function VercelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="m8 1 8 14H0z" />
    </svg>
  )
}
