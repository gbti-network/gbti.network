// SOURCE DEFINITIONS — managed here at the filesystem level (no database).
//
// The RSS/Atom feeds the hourly cron polls. Edit by hand, import an OPML
// (`node scripts/import-opml.mjs`), or discover from daily.dev highlights
// (`node scripts/discover-sources.mjs`). Each entry: { id, name, description, url }.
//
// 121 sources => suggested SOURCE_CHUNK ~= 30 in wrangler.toml (rotate within the free tier).

export const SOURCES = [
  {
    "id": "the-next-web",
    "name": "The Next Web",
    "description": "Discovered via daily.dev highlights — thenextweb.com",
    "url": "https://thenextweb.com/feed/"
  },
  {
    "id": "bleepingcomputer",
    "name": "BleepingComputer",
    "description": "Discovered via daily.dev highlights — www.bleepingcomputer.com",
    "url": "https://www.bleepingcomputer.com/feed/"
  },
  {
    "id": "dark-reading",
    "name": "Dark Reading",
    "description": "Discovered via daily.dev highlights — www.darkreading.com",
    "url": "https://www.darkreading.com/rss.xml"
  },
  {
    "id": "phoronix",
    "name": "Phoronix",
    "description": "Discovered via daily.dev highlights — www.phoronix.com",
    "url": "https://www.phoronix.com/rss.php"
  },
  {
    "id": "orca-security-blog",
    "name": "Orca Security Blog",
    "description": "Discovered via daily.dev highlights — orca.security",
    "url": "https://orca.security/feed/"
  },
  {
    "id": "ars-technica",
    "name": "Ars Technica",
    "description": "Discovered via daily.dev highlights — arstechnica.com",
    "url": "https://arstechnica.com/feed/"
  },
  {
    "id": "cso-online",
    "name": "CSO Online",
    "description": "Discovered via daily.dev highlights — www.csoonline.com",
    "url": "https://www.csoonline.com/feed/"
  },
  {
    "id": "hackaday",
    "name": "Hackaday",
    "description": "Discovered via daily.dev highlights — hackaday.com",
    "url": "https://hackaday.com/feed/"
  },
  {
    "id": "unit-42",
    "name": "Unit 42",
    "description": "Discovered via daily.dev highlights — unit42.paloaltonetworks.com",
    "url": "https://unit42.paloaltonetworks.com/feed/"
  },
  {
    "id": "securelist",
    "name": "Securelist",
    "description": "Discovered via daily.dev highlights — securelist.com",
    "url": "https://securelist.com/feed/"
  },
  {
    "id": "latest-hacking-news",
    "name": "Latest Hacking News",
    "description": "Discovered via daily.dev highlights — latesthackingnews.com",
    "url": "https://latesthackingnews.com/feed/"
  },
  {
    "id": "dfir-ch",
    "name": "dfir.ch",
    "description": "Discovered via daily.dev highlights — dfir.ch",
    "url": "https://dfir.ch/index.xml"
  },
  {
    "id": "socket",
    "name": "Socket",
    "description": "Discovered via daily.dev highlights — socket.dev",
    "url": "https://socket.dev/api/blog/feed.atom"
  },
  {
    "id": "aws",
    "name": "AWS",
    "description": "Discovered via daily.dev highlights — aws.amazon.com",
    "url": "https://aws.amazon.com/rss"
  },
  {
    "id": "the-register",
    "name": "The Register",
    "description": "Discovered via daily.dev highlights — www.theregister.com",
    "url": "https://www.theregister.com/feed/"
  },
  {
    "id": "techcentral",
    "name": "TechCentral",
    "description": "Discovered via daily.dev highlights — techcentral.co.za",
    "url": "https://techcentral.co.za/feed/"
  },
  {
    "id": "infoq",
    "name": "InfoQ",
    "description": "Discovered via daily.dev highlights — www.infoq.com",
    "url": "https://www.infoq.com/feed/"
  },
  {
    "id": "techcrunch",
    "name": "TechCrunch",
    "description": "Discovered via daily.dev highlights — techcrunch.com",
    "url": "https://techcrunch.com/feed/"
  },
  {
    "id": "schneier-on-security",
    "name": "Schneier on Security",
    "description": "Discovered via daily.dev highlights — www.schneier.com",
    "url": "https://www.schneier.com/feed/"
  },
  {
    "id": "reid-burke",
    "name": "Reid Burke",
    "description": "Discovered via daily.dev highlights — security.apple.com",
    "url": "https://security.apple.com/blog/feed.rss"
  },
  {
    "id": "about-fb-com",
    "name": "about.fb.com",
    "description": "Discovered via daily.dev highlights — about.fb.com",
    "url": "https://about.fb.com/feed/"
  },
  {
    "id": "omg-ubuntu",
    "name": "omg! ubuntu!",
    "description": "Discovered via daily.dev highlights — www.omgubuntu.co.uk",
    "url": "https://www.omgubuntu.co.uk/feed"
  },
  {
    "id": "dev-to",
    "name": "dev.to",
    "description": "Discovered via daily.dev highlights — dev.to",
    "url": "https://dev.to/feed"
  },
  {
    "id": "mozilla",
    "name": "Mozilla",
    "description": "Discovered via daily.dev highlights — blog.mozilla.org",
    "url": "https://blog.mozilla.org/en/feed/"
  },
  {
    "id": "mdn-blog",
    "name": "MDN Blog",
    "description": "Discovered via daily.dev highlights — developer.mozilla.org",
    "url": "https://developer.mozilla.org/en-US/blog/rss.xml"
  },
  {
    "id": "xda-developers",
    "name": "XDA Developers",
    "description": "Discovered via daily.dev highlights — www.xda-developers.com",
    "url": "https://www.xda-developers.com/feed/"
  },
  {
    "id": "elixir-forum",
    "name": "Elixir Forum",
    "description": "Discovered via daily.dev highlights — elixirforum.com",
    "url": "https://elixirforum.com/posts.rss"
  },
  {
    "id": "devops-com",
    "name": "DevOps.com",
    "description": "Discovered via daily.dev highlights — devops.com",
    "url": "https://devops.com/feed/"
  },
  {
    "id": "visual-studio-blog",
    "name": "Visual Studio Blog",
    "description": "Discovered via daily.dev highlights — devblogs.microsoft.com",
    "url": "https://devblogs.microsoft.com/feed/"
  },
  {
    "id": "bytecodealliance-org",
    "name": "bytecodealliance.org",
    "description": "Discovered via daily.dev highlights — bytecodealliance.org",
    "url": "https://bytecodealliance.org/feed.xml"
  },
  {
    "id": "node-js",
    "name": "Node.js",
    "description": "Discovered via daily.dev highlights — nodejs.org",
    "url": "https://nodejs.org/en/feed/blog.xml"
  },
  {
    "id": "webkit",
    "name": "WebKit",
    "description": "Discovered via daily.dev highlights — webkit.org",
    "url": "https://webkit.org/feed/"
  },
  {
    "id": "github-changelog",
    "name": "GitHub Changelog",
    "description": "Discovered via daily.dev highlights — github.blog",
    "url": "https://github.blog/feed/"
  },
  {
    "id": "thehackernews-com",
    "name": "thehackernews.com",
    "description": "Discovered via daily.dev highlights — thehackernews.com",
    "url": "https://feeds.feedburner.com/TheHackersNews"
  },
  {
    "id": "lobsters",
    "name": "Lobsters",
    "description": "Discovered via daily.dev highlights — servo.org",
    "url": "https://servo.org/blog/feed.xml"
  },
  {
    "id": "visual-studio-code",
    "name": "Visual Studio Code",
    "description": "Discovered via daily.dev highlights — code.visualstudio.com",
    "url": "https://code.visualstudio.com/feed.xml"
  },
  {
    "id": "angular",
    "name": "Angular",
    "description": "Discovered via daily.dev highlights — blog.angular.dev",
    "url": "https://blog.angular.dev/feed"
  },
  {
    "id": "the-new-stack",
    "name": "The New Stack",
    "description": "Discovered via daily.dev highlights — thenewstack.io",
    "url": "https://thenewstack.io/blog/feed/"
  },
  {
    "id": "lobsters-2",
    "name": "Lobsters",
    "description": "Discovered via daily.dev highlights — www.iroh.computer",
    "url": "https://www.iroh.computer/rss.xml"
  },
  {
    "id": "rubyland",
    "name": "RUBYLAND",
    "description": "Discovered via daily.dev highlights — andre.arko.net",
    "url": "https://andre.arko.net/index.xml"
  },
  {
    "id": "aikido-security",
    "name": "Aikido Security",
    "description": "Discovered via daily.dev highlights — www.aikido.dev",
    "url": "https://www.aikido.dev/blog/rss.xml"
  },
  {
    "id": "blog-gitbutler-com",
    "name": "blog.gitbutler.com",
    "description": "Discovered via daily.dev highlights — blog.gitbutler.com",
    "url": "https://blog.gitbutler.com/rss"
  },
  {
    "id": "jetbrains",
    "name": "JetBrains",
    "description": "Discovered via daily.dev highlights — blog.jetbrains.com",
    "url": "https://blog.jetbrains.com/feed/"
  },
  {
    "id": "railway-blog",
    "name": "Railway Blog",
    "description": "Discovered via daily.dev highlights — blog.railway.com",
    "url": "https://blog.railway.com/rss.xml"
  },
  {
    "id": "rust",
    "name": "Rust",
    "description": "Discovered via daily.dev highlights — blog.rust-lang.org",
    "url": "https://blog.rust-lang.org/feed.xml"
  },
  {
    "id": "lwn-net",
    "name": "LWN.net",
    "description": "Discovered via daily.dev highlights — lwn.net",
    "url": "https://lwn.net/headlines/rss"
  },
  {
    "id": "tokio",
    "name": "Tokio",
    "description": "Discovered via daily.dev highlights — tokio.rs",
    "url": "https://tokio.rs/blog/index.xml"
  },
  {
    "id": "drew-devault",
    "name": "Drew DeVault",
    "description": "Discovered via daily.dev highlights — drewdevault.com",
    "url": "https://drewdevault.com/blog/index.xml"
  },
  {
    "id": "react-blog",
    "name": "React Blog",
    "description": "Curated feed — react.dev",
    "url": "https://react.dev/rss.xml"
  },
  {
    "id": "the-vue-point",
    "name": "The Vue Point",
    "description": "Curated feed — blog.vuejs.org",
    "url": "https://blog.vuejs.org/feed.rss"
  },
  {
    "id": "svelte-dev",
    "name": "svelte.dev",
    "description": "Curated feed — svelte.dev",
    "url": "https://svelte.dev/blog/rss.xml"
  },
  {
    "id": "next-js-blog",
    "name": "Next.js Blog",
    "description": "Curated feed — nextjs.org",
    "url": "https://nextjs.org/feed.xml"
  },
  {
    "id": "djangoproject-com",
    "name": "djangoproject.com",
    "description": "Curated feed — www.djangoproject.com",
    "url": "https://www.djangoproject.com/rss/weblog/"
  },
  {
    "id": "laravel-news",
    "name": "Laravel News",
    "description": "Curated feed — laravel-news.com",
    "url": "https://laravel-news.com/feed"
  },
  {
    "id": "spring-io",
    "name": "spring.io",
    "description": "Curated feed — spring.io",
    "url": "https://spring.io/blog.atom"
  },
  {
    "id": "kubernetes-io",
    "name": "kubernetes.io",
    "description": "Curated feed — kubernetes.io",
    "url": "https://kubernetes.io/feed.xml"
  },
  {
    "id": "deno",
    "name": "Deno",
    "description": "Curated feed — deno.com",
    "url": "https://deno.com/feed"
  },
  {
    "id": "the-astro-blog",
    "name": "The Astro Blog",
    "description": "Curated feed — astro.build",
    "url": "https://astro.build/rss.xml"
  },
  {
    "id": "css-tricks",
    "name": "CSS-Tricks",
    "description": "Curated feed — css-tricks.com",
    "url": "https://css-tricks.com/feed/"
  },
  {
    "id": "articles-on-smashing-magazine-for-web-de",
    "name": "Articles on Smashing Magazine — For Web Designers And Developers",
    "description": "Curated feed — www.smashingmagazine.com",
    "url": "https://www.smashingmagazine.com/feed/"
  },
  {
    "id": "stack-overflow-blog",
    "name": "Stack Overflow Blog",
    "description": "Curated feed — stackoverflow.blog",
    "url": "https://stackoverflow.blog/feed/"
  },
  {
    "id": "coindesk-bitcoin-ethereum-crypto-news-an",
    "name": "CoinDesk: Bitcoin, Ethereum, Crypto News and Price Data",
    "description": "Curated feed — www.coindesk.com",
    "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"
  },
  {
    "id": "cointelegraph-com-news",
    "name": "Cointelegraph.com News",
    "description": "Curated feed — cointelegraph.com",
    "url": "https://cointelegraph.com/rss"
  },
  {
    "id": "decrypt",
    "name": "Decrypt",
    "description": "Curated feed — decrypt.co",
    "url": "https://decrypt.co/feed"
  },
  {
    "id": "the-block",
    "name": "The Block",
    "description": "Curated feed — www.theblock.co",
    "url": "https://www.theblock.co/rss.xml"
  },
  {
    "id": "ethereum-foundation-blog",
    "name": "Ethereum Foundation Blog",
    "description": "Curated feed — blog.ethereum.org",
    "url": "https://blog.ethereum.org/feed.xml"
  },
  {
    "id": "bitcoin-magazine",
    "name": "Bitcoin Magazine",
    "description": "Curated feed — bitcoinmagazine.com",
    "url": "https://bitcoinmagazine.com/feed"
  },
  {
    "id": "object-object",
    "name": "The Verge",
    "description": "Curated feed — www.theverge.com",
    "url": "https://www.theverge.com/rss/index.xml"
  },
  {
    "id": "wired",
    "name": "WIRED",
    "description": "Curated feed — www.wired.com",
    "url": "https://www.wired.com/feed/rss"
  },
  {
    "id": "engadget-technology-news-expert-reviews",
    "name": "Engadget - Technology News & Expert Reviews",
    "description": "Curated feed — www.engadget.com",
    "url": "https://www.engadget.com/rss.xml"
  },
  {
    "id": "mit-technology-review",
    "name": "MIT Technology Review",
    "description": "Curated feed — www.technologyreview.com",
    "url": "https://www.technologyreview.com/feed/"
  },
  {
    "id": "techspot",
    "name": "TechSpot",
    "description": "Curated feed — www.techspot.com",
    "url": "https://www.techspot.com/backend.xml"
  },
  {
    "id": "latest-from-tom-s-hardware",
    "name": "Latest from Tom's Hardware",
    "description": "Curated feed — www.tomshardware.com",
    "url": "https://www.tomshardware.com/feeds/all"
  },
  {
    "id": "servethehome",
    "name": "ServeTheHome",
    "description": "Curated feed — www.servethehome.com",
    "url": "https://www.servethehome.com/feed/"
  },
  {
    "id": "ieee-spectrum",
    "name": "IEEE Spectrum",
    "description": "Curated feed — spectrum.ieee.org",
    "url": "https://spectrum.ieee.org/feeds/feed.rss"
  },
  {
    "id": "electrek",
    "name": "Electrek",
    "description": "Curated feed — electrek.co",
    "url": "https://electrek.co/feed/"
  },
  {
    "id": "cleantechnica",
    "name": "CleanTechnica",
    "description": "Curated feed — cleantechnica.com",
    "url": "https://cleantechnica.com/feed/"
  },
  {
    "id": "pv-magazine-global",
    "name": "pv magazine Global",
    "description": "Curated feed — www.pv-magazine.com",
    "url": "https://www.pv-magazine.com/feed/"
  },
  {
    "id": "canary-media",
    "name": "Canary Media",
    "description": "Curated feed — www.canarymedia.com",
    "url": "https://www.canarymedia.com/feed"
  },
  {
    "id": "insideevs-articles",
    "name": "InsideEVs - Articles",
    "description": "Curated feed — insideevs.com",
    "url": "https://insideevs.com/rss/articles/all/"
  },
  {
    "id": "stephen-wolfram-writings",
    "name": "Stephen Wolfram Writings",
    "description": "Discovered via daily.dev highlights — writings.stephenwolfram.com",
    "url": "https://writings.stephenwolfram.com/feed/"
  },
  {
    "id": "newsletter-pragmaticengineer-com",
    "name": "newsletter.pragmaticengineer.com",
    "description": "Discovered via daily.dev highlights — newsletter.pragmaticengineer.com",
    "url": "https://newsletter.pragmaticengineer.com/feed"
  },
  {
    "id": "where-s-your-ed-at",
    "name": "Where's Your Ed At",
    "description": "Discovered via daily.dev highlights — www.wheresyoured.at",
    "url": "https://www.wheresyoured.at/rss/"
  },
  {
    "id": "abit-ee",
    "name": "abit.ee",
    "description": "Discovered via daily.dev highlights — abit.ee",
    "url": "https://abit.ee/en/?format=feed&amp;type=rss"
  },
  {
    "id": "watchtowr-labs",
    "name": "watchTowr Labs",
    "description": "Discovered via daily.dev highlights — labs.watchtowr.com",
    "url": "https://labs.watchtowr.com/rss/"
  },
  {
    "id": "gamesindustry-biz",
    "name": "GamesIndustry.biz",
    "description": "Discovered via daily.dev highlights — www.gamesindustry.biz",
    "url": "https://www.gamesindustry.biz/feed"
  },
  {
    "id": "docker",
    "name": "Docker",
    "description": "Discovered via daily.dev highlights — www.docker.com",
    "url": "https://www.docker.com/feed/"
  },
  {
    "id": "we-are-net",
    "name": "We Are .NET",
    "description": "Discovered via daily.dev highlights — daily-devops.net",
    "url": "https://daily-devops.net/feed.rss"
  },
  {
    "id": "sd-times",
    "name": "SD Times",
    "description": "Discovered via daily.dev highlights — sdtimes.com",
    "url": "https://sdtimes.com/feed/"
  },
  {
    "id": "databricks",
    "name": "databricks",
    "description": "Discovered via daily.dev highlights — www.databricks.com",
    "url": "https://www.databricks.com/feed/"
  },
  {
    "id": "devops-daily-com",
    "name": "devops-daily.com",
    "description": "Discovered via daily.dev highlights — devops-daily.com",
    "url": "https://devops-daily.com/feed.xml"
  },
  {
    "id": "cloudflare",
    "name": "Cloudflare",
    "description": "Discovered via daily.dev highlights — blog.cloudflare.com",
    "url": "https://blog.cloudflare.com/rss"
  },
  {
    "id": "clickhouse",
    "name": "ClickHouse",
    "description": "Discovered via daily.dev highlights — clickhouse.com",
    "url": "https://clickhouse.com/rss.xml"
  },
  {
    "id": "lobsters-3",
    "name": "Lobsters",
    "description": "Discovered via daily.dev highlights — lantian.pub",
    "url": "https://lantian.pub/rss2.xml"
  },
  {
    "id": "cyble",
    "name": "Cyble",
    "description": "Discovered via daily.dev highlights — cyble.com",
    "url": "https://cyble.com/feed/"
  },
  {
    "id": "cncf",
    "name": "CNCF",
    "description": "Discovered via daily.dev highlights — www.cncf.io",
    "url": "https://www.cncf.io/feed/"
  },
  {
    "id": "infoworld",
    "name": "InfoWorld",
    "description": "Discovered via daily.dev highlights — www.infoworld.com",
    "url": "https://www.infoworld.com/feed/"
  },
  {
    "id": "blog-trailofbits-com",
    "name": "blog.trailofbits.com",
    "description": "Discovered via daily.dev highlights — blog.trailofbits.com",
    "url": "https://blog.trailofbits.com/feed/"
  },
  {
    "id": "wawandco",
    "name": "Wawandco",
    "description": "Discovered via daily.dev highlights — wawand.co",
    "url": "https://wawand.co/index.xml"
  },
  {
    "id": "gitlab",
    "name": "GitLab",
    "description": "Discovered via daily.dev highlights — about.gitlab.com",
    "url": "https://about.gitlab.com/releases.xml"
  },
  {
    "id": "devclass",
    "name": "DEVCLASS",
    "description": "Discovered via daily.dev highlights — www.devclass.com",
    "url": "https://www.devclass.com/feed/"
  },
  {
    "id": "astral",
    "name": "Astral",
    "description": "Discovered via daily.dev highlights — astral.sh",
    "url": "https://astral.sh/blog/rss.xml"
  },
  {
    "id": "bite-code",
    "name": "Bite Code",
    "description": "Discovered via daily.dev highlights — www.bitecode.dev",
    "url": "https://www.bitecode.dev/feed"
  },
  {
    "id": "simon-willison",
    "name": "Simon Willison",
    "description": "Discovered via daily.dev highlights — simonwillison.net",
    "url": "https://simonwillison.net/atom/everything/"
  },
  {
    "id": "google-developers",
    "name": "Google Developers",
    "description": "Discovered via daily.dev highlights — developers.googleblog.com",
    "url": "https://developers.googleblog.com/feed/"
  },
  {
    "id": "pytorch",
    "name": "PyTorch",
    "description": "Discovered via daily.dev highlights — pytorch.org",
    "url": "https://pytorch.org/feed/"
  },
  {
    "id": "python-insider",
    "name": "Python Insider",
    "description": "Discovered via daily.dev highlights — blog.python.org",
    "url": "https://blog.python.org/rss.xml"
  },
  {
    "id": "planet-python",
    "name": "Planet Python",
    "description": "Discovered via daily.dev highlights — www.pypy.org",
    "url": "https://www.pypy.org/rss.xml"
  },
  {
    "id": "planet-python-2",
    "name": "Planet Python",
    "description": "Discovered via daily.dev highlights — grahamdumpleton.me",
    "url": "https://grahamdumpleton.me/feed"
  },
  {
    "id": "planet-python-3",
    "name": "Planet Python",
    "description": "Discovered via daily.dev highlights — nuitka.net",
    "url": "https://nuitka.net/blog/atom.xml"
  },
  {
    "id": "flink",
    "name": "Flink",
    "description": "Discovered via daily.dev highlights — flink.apache.org",
    "url": "https://flink.apache.org/index.xml"
  },
  {
    "id": "python-software-foundation",
    "name": "Python Software Foundation",
    "description": "Discovered via daily.dev highlights — pyfound.blogspot.com",
    "url": "https://pyfound.blogspot.com/feeds/posts/default"
  },
  {
    "id": "openssf",
    "name": "OpenSSF",
    "description": "Discovered via daily.dev highlights — openssf.org",
    "url": "https://openssf.org/feed/"
  },
  {
    "id": "zero-to-mastery-april-2026",
    "name": "Zero To Mastery - April 2026",
    "description": "Discovered via daily.dev highlights — safedep.io",
    "url": "https://safedep.io/rss.xml"
  },
  {
    "id": "rust-foundation",
    "name": "Rust Foundation",
    "description": "Discovered via daily.dev highlights — rustfoundation.org",
    "url": "https://rustfoundation.org/feed/"
  },
  {
    "id": "fedora-magazine",
    "name": "Fedora Magazine",
    "description": "Discovered via daily.dev highlights — fedoramagazine.org",
    "url": "https://fedoramagazine.org/feed/"
  },
  {
    "id": "godot",
    "name": "Godot",
    "description": "Discovered via daily.dev highlights — godotengine.org",
    "url": "https://godotengine.org/rss.xml"
  },
  {
    "id": "brew-sh",
    "name": "brew.sh",
    "description": "Discovered via daily.dev highlights — brew.sh",
    "url": "https://brew.sh/atom.xml"
  },
  {
    "id": "andrew-nesbitt",
    "name": "Andrew Nesbitt",
    "description": "Discovered via daily.dev highlights — nesbitt.io",
    "url": "https://nesbitt.io/feed.xml"
  },
  {
    "id": "rubyland-2",
    "name": "RUBYLAND",
    "description": "Discovered via daily.dev highlights — rubycentral.org",
    "url": "https://rubycentral.org/news/rss/"
  },
  {
    "id": "lobsters-4",
    "name": "Lobsters",
    "description": "Discovered via daily.dev highlights — alpinelinux.org",
    "url": "https://alpinelinux.org/atom.xml"
  }
];
