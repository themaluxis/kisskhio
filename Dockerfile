FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY index.js ./

EXPOSE 7000

# Default values - override with environment variables
ENV PORT=7000
ENV MEDIAFLOW_PROXY_URL=""
ENV MEDIAFLOW_API_PASSWORD=""

CMD ["node", "index.js"]
