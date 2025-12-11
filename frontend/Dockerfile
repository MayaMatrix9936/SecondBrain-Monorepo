FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Accept VITE_API_URL as build argument
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]

