# Build stage
FROM node:18-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Create favicon
RUN echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff6500"/><circle cx="50" cy="50" r="25" fill="#fff"/></svg>' > /usr/share/nginx/html/favicon.svg

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]