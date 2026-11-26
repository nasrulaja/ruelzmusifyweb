# RuelzMusify Web
#
# yt-dlp must run as a real process, so this image is for a long-running host
# (Fly.io / Render / Railway / VPS). It will not work on Vercel or Netlify.
FROM node:22-slim

# python3 + ffmpeg: server.mjs shells out to `python -m yt_dlp`
# yt-dlp-exec's postinstall also probes a literal `python` binary, which Debian
# does not ship, so link it before npm ci runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/python3 /usr/local/bin/python

# pinned separately so it can be bumped without rebuilding the layer above
RUN python3 -m pip install --no-cache-dir --break-system-packages -U yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PYTHON=python3
# hosting platforms inject PORT; 7788 is only the local default
EXPOSE 7788

USER node
CMD ["node", "server.mjs"]
