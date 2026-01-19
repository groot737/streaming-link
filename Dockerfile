# Use a lightweight Node.js image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker cache for dependencies
COPY package.json package-lock.json ./

# Install dependencies strictly from the lockfile
RUN npm ci

# Copy the rest of the application code
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
