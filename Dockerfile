# Stage 1: Build
FROM node:20-alpine as build-stage

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application
# Note: VITE_* env vars must be available during this step
RUN npm run build

# Stage 2: Serve
FROM nginx:stable-alpine as production-stage

# Copy the build output from the previous stage to Nginx's html directory
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Copy a custom nginx configuration to handle SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
