# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# lock 파일 존재 시 npm ci (재현 가능 빌드), 없으면 npm install 폴백
RUN if [ -f package-lock.json ]; then npm ci --prefer-offline; else npm install; fi
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
