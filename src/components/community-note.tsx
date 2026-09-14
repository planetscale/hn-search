/**
 * Static "what people are saying" column shown beside the results list on the
 * home page. The tweets are hardcoded (no embed widget / client script): each
 * card is a plain link to the original post on X.
 */

type Tweet = {
  name: string
  handle: string
  avatar: string
  text: string
  url: string
}

const TWEETS: Tweet[] = [
  {
    name: 'Guillermo Rauch',
    handle: 'rauchg',
    avatar: 'https://pbs.twimg.com/profile_images/1783856060249595904/8TfcCN0r_normal.jpg',
    text: 'Cool',
    url: 'https://x.com/rauchg/status/2099501000520515884',
  },
  {
    name: 'Saïd Aitmbarek',
    handle: 'SaidAitmbarek',
    avatar: 'https://pbs.twimg.com/profile_images/1891564978177454080/YzRSDzkw_normal.jpg',
    text: 'neon is dope🔥',
    url: 'https://x.com/SaidAitmbarek/status/2099434860594995533',
  },
  {
    name: "James O'Reilly",
    handle: 'jrzscodes',
    avatar: 'https://pbs.twimg.com/profile_images/2099141476382904325/NQvQQVga_normal.jpg',
    text: 'Pretty awesome job!',
    url: 'https://x.com/jrzscodes/status/2099464022240194874',
  },
]

/** Blue verification check. All three accounts are verified. */
function VerifiedBadge() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Verified account" className="inline-block h-[1em] w-[1em] shrink-0 align-[-0.15em]" fill="#1d9bf0">
      <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.68.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91c-1.31.66-2.19 1.91-2.19 3.34s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
    </svg>
  )
}

/** X (Twitter) glyph shown in the corner of each card. */
function XMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[0.9em] w-[0.9em] shrink-0 fill-(--hn-gray)">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export function CommunityNote() {
  return (
    <div className="bg-white px-2 py-1.5 text-(length:--text-sm) text-(--hn-gray)">
      <span className="font-bold text-(--hn-ink)">💬 What people are saying</span>
      <div className="mt-2 flex flex-col gap-2">
        {TWEETS.map((t) => (
          <a key={t.handle} href={t.url} target="_blank" rel="noreferrer" className="flex flex-1 flex-col gap-1.5 rounded border border-(--hn-gray-line) p-2 no-underline hover:border-(--hn-orange) hover:no-underline">
            <div className="flex items-center gap-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.avatar} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 shrink-0 rounded-full" />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="flex items-center gap-0.5 truncate font-bold text-(--hn-ink)">
                  {t.name}
                  <VerifiedBadge />
                </span>
                <span className="truncate">@{t.handle}</span>
              </span>
              <XMark />
            </div>
            <p className="text-(--hn-ink)">{t.text}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
