FROM node:20-alpine
WORKDIR /app
# Copy package files first for better layer caching
COPY package*.json ./
# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force
# Copy application code
COPY . .
ENV PORT=4000
EXPOSE 4000
CMD ["node","server.js"]
