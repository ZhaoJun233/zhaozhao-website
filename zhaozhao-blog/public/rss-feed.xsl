<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" encoding="UTF-8" />
  <xsl:template match="/rss/channel">
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title><xsl:value-of select="title" /> · RSS</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #f4f3ef; color: #282623; font-family: "Hiragino Sans", "Yu Gothic UI", "Microsoft YaHei", sans-serif; line-height: 1.7; }
          header { padding: 4rem max(1.25rem, calc((100% - 68rem) / 2)); border-bottom: 1px solid #dad7d0; background: #fbfaf7; }
          .eyebrow { margin: 0 0 .7rem; color: #0a7580; font-size: .72rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
          h1 { max-width: 18ch; margin: 0; font-family: "Iowan Old Style", "Palatino Linotype", "Noto Serif CJK SC", serif; font-size: clamp(2.4rem, 7vw, 5.5rem); font-weight: 600; line-height: 1.05; }
          header p:last-of-type { max-width: 48rem; margin: 1.2rem 0 0; color: #716d66; }
          header a { display: inline-block; margin-top: 1.5rem; padding-bottom: .2rem; border-bottom: 1px solid #cf5677; color: inherit; font-size: .78rem; font-weight: 700; text-decoration: none; }
          header a + a { margin-inline-start: 1.4rem; }
          main { width: min(calc(100% - 2.5rem), 68rem); margin: 0 auto; padding: 3rem 0 6rem; }
          .feed-meta { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; color: #77726b; font-size: .7rem; }
          ol { margin: 0; padding: 1px; background: #dedbd5; list-style: none; }
          li { display: grid; grid-template-columns: 4rem minmax(0, 1fr) auto; gap: 1.5rem; padding: 1.5rem; background: #fff; }
          li + li { margin-top: 1px; }
          .number { color: #a09a92; font-family: "Iowan Old Style", serif; font-size: .7rem; font-style: italic; }
          h2 { margin: 0 0 .45rem; font-family: "Iowan Old Style", "Noto Serif CJK SC", serif; font-size: clamp(1.3rem, 3vw, 1.9rem); line-height: 1.25; }
          h2 a { color: inherit; text-decoration: none; }
          h2 a:hover { color: #086d77; }
          .description { max-width: 56rem; margin: 0; color: #716d66; font-size: .78rem; }
          time { color: #8a857d; font-size: .68rem; white-space: nowrap; }
          footer { width: min(calc(100% - 2.5rem), 68rem); margin: 0 auto; padding: 1.5rem 0 3rem; border-top: 1px solid #dad7d0; color: #817c75; font-size: .68rem; }
          @media (max-width: 640px) { header { padding-block: 2.5rem; } li { grid-template-columns: 2rem minmax(0, 1fr); gap: .8rem; } time { grid-column: 2; } }
        </style>
      </head>
      <body>
        <header>
          <p class="eyebrow">RSS · 文章订阅</p>
          <h1><xsl:value-of select="title" /></h1>
          <p><xsl:value-of select="description" /></p>
          <a href="{link}">返回博客首页 →</a>
          <a href="https://github.com/ZhaoJun233">GitHub 主页 →</a>
        </header>
        <main>
          <div class="feed-meta"><span>最近更新</span><span><xsl:value-of select="count(item)" /> 篇文章</span></div>
          <ol>
            <xsl:for-each select="item">
              <li>
                <span class="number"><xsl:number value="position()" format="01" /></span>
                <article>
                  <h2><a href="{link}"><xsl:value-of select="title" /></a></h2>
                  <p class="description"><xsl:value-of select="description" /></p>
                </article>
                <time><xsl:value-of select="pubDate" /></time>
              </li>
            </xsl:for-each>
          </ol>
        </main>
        <footer>标准 RSS 2.0 订阅源 · <xsl:value-of select="link" /></footer>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
