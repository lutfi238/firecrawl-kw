export function htmlToMarkdown(html: string): string {
  let md = html;
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  md = md.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  md = md.replace(/<header[\s\S]*?<\/header>/gi, "");
  md = md.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");
  // Images: pull the real URL, preferring lazy-load attributes used by SPAs
  // (data-src / data-lazy-src / data-original) over a placeholder src.
  md = md.replace(/<img\b[^>]*>/gi, (tag) => {
    const altMatch = tag.match(/\balt="([^"]*)"/i);
    const alt = altMatch ? altMatch[1] : "";
    const src = extractImageSrc(tag);
    return src ? `![${alt}](${src})` : "";
  });

  md = md.replace(/<[^>]+>/g, "");
  md = md
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // Drop placeholder images/links left behind by lazy-loaded or ad markup.
  md = md.replace(/!\[[^\]]*\]\(\s*\)/g, ""); // images with no URL
  md = md.replace(/\[\s*\]\([^)]*\)/g, ""); // links with empty text (pass 1)
  md = stripNoisyImages(md);
  md = stripNoiseLines(md);
  // Second pass: remove empty links left behind after noisy image removal
  // and links pointing to known spam/ad domains.
  md = removeSpamLinks(md);
  md = md.replace(/\[\s*\]\([^)]*\)/g, ""); // links with empty text (pass 2)

  // Strip leftover inline UI button text (Refresh, Download App, Close, etc.)
  md = md.replace(/\bRefresh\b/g, "");
  md = md.replace(/\bDownload App\b/g, "");
  md = md.replace(/\bClose\b/g, "");
  md = md.replace(/\d+\s*Close\b/g, "");

  // Fix concatenated section headings (e.g. "NewestProject" → separate lines)
  md = md.replace(/NewestProject/g, "Newest\n\nProject");

  // Separate consecutive markdown links that got smashed together.
  // Turn `](url)[` into `]\n\n[` so each link gets its own line.
  md = md.replace(/\]\(([^)]+)\)\s*\[/g, "]($1)\n\n[");

  // Insert newline before a link only when smashed directly against inline
  // text (e.g. "NewestProject["), NOT when separated by whitespace (normal
  // inline links like "Visit [Example]") and NOT before images (![).
  md = md.replace(/([^\s!])\[/g, "$1\n\n[");

  md = md.replace(/[ \t]+\n/g, "\n");
  md = md.replace(/\n{3,}/g, "\n\n").trim();

  return md;
}

// Extract a usable image URL from an <img> tag, ignoring data-URI spinners.
function extractImageSrc(tag: string): string {
  const attrs = ["data-src", "data-lazy-src", "data-original", "src"];
  for (const attr of attrs) {
    const m = tag.match(new RegExp(`\\b${attr}="([^"]*)"`, "i"));
    const val = m ? m[1].trim() : "";
    if (val && !/^data:/i.test(val)) return val;
  }
  return "";
}

// Remove standalone lines that are pure UI/ad noise (loading shells, adblock
// nags). Strips markdown heading markers before checking so `#### AdBlock`
// is caught too.
function stripNoiseLines(md: string): string {
  const noise = [
    /^#+\s*loading\b.*$/i,
    /^loading\b.*$/i,
    /^#+\s*please wait\.*$/i,
    /^please wait\.*$/i,
    /^#+\s*adblock detected.*$/i,
    /^adblock detected.*$/i,
    /^#+\s*please disable your ad ?blocker.*$/i,
    /^please disable your ad ?blocker.*$/i,
    /^#+\s*kamu belum login.*$/i,
    /^kamu belum login.*$/i,
    /^silahkan login untuk akses.*$/i,
    /^login$/i,
    /^refresh$/i,
    /^you need to enable javascript.*$/i,
  ];
  return md
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      return !noise.some((re) => re.test(t));
    })
    .join("\n");
}

// Remove image lines that are clearly loading spinners or ad banners.
// Catches both bare `![alt](url)` and wrapped `[![alt](url)](href)`.
function stripNoisyImages(md: string): string {
  const adImg = /(loading|spinner|480p|ads?\/banner|imgkc1\.my\.id)/i;
  const adSlot = /^\[?[LR]-\d+$/i; // L-1, R-3, [L-1], etc.

  // Bare spinner/ad images: ![Loading...](/assets/480p.gif)
  md = md.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt: string, url: string) => {
      if (adImg.test(alt) || adImg.test(url)) return "";
      return match;
    },
  );

  // Ad-link wrappers: [![L-1](cdn-image)](spam-url)
  md = md.replace(
    /\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g,
    (match, alt: string) => {
      if (adSlot.test(alt.trim())) return "";
      return match;
    },
  );

  return md;
}

// Remove links pointing to known spam, gambling, or ad-redirect domains.
// Also catches leftover `text[](url)` patterns where the image was stripped.
function removeSpamLinks(md: string): string {
  // Common spam/gambling/ad-redirect domains seen on manga/manhua sites.
  const spamDomain =
    /(7kucing|masuk2\d*|redirect(?:bisnis|bandar|hero)|qqsawer|emas5000|goid\.space|gacor\.zone|server-x7|injd\.site|menujupenta|kegz\.site|orangarab|bergurukecina|terbangrusia|goratu\.site|akseskaiko|dw\.zeus\.fun)/i;

  // Remove any link (with or without text) pointing to a spam domain.
  md = md.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text: string, url: string) => {
      if (spamDomain.test(url)) return "";
      return match;
    },
  );

  return md;
}
