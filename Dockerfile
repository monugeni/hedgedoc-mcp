FROM node:22-alpine AS builder
WORKDIR /opt/mcp
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM quay.io/hedgedoc/hedgedoc:1.10.0
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends supervisor pandoc weasyprint fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/mcp
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY --from=builder /opt/mcp/dist dist/

COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

WORKDIR /hedgedoc
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
