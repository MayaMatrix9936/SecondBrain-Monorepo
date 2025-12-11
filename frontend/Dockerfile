FROM node:18-alpine
WORKDIR /app
# Copy package files first for better layer caching
COPY package*.json ./
# Install all dependencies (needed for build and preview)
RUN npm install
# Copy source code
COPY . .
# Accept VITE_API_URL as build argument
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
# Build the application
RUN npm run build
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]

