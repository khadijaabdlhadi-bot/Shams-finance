# ---------- بناء واجهة المستخدم ----------
FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY web/package*.json ./web/
RUN cd web && npm install --omit=dev --no-audit --no-fund || cd web && npm install --no-audit --no-fund
COPY web ./web
RUN cd web && npm install --no-audit --no-fund && npm run build

# ---------- التشغيل ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production

# postgresql-client: لأدوات النسخ الاحتياطي والاسترجاع (pg_dump / pg_restore)
# chromium + خطوط عربية: لتحويل الإيصالات والتقارير إلى PDF بالعربية بشكل صحيح
RUN apt-get update && apt-get install -y --no-install-recommends \
      postgresql-client \
      chromium \
      fonts-noto-core fonts-noto-ui-core fonts-kacst fonts-hosny-amiri \
      ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

COPY server ./server
COPY --from=web /build/web/dist ./web/dist

ENV DATA_DIR=/data \
    WEB_DIST=/app/web/dist \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
