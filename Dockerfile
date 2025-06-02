# Use official Node.js LTS base image
FROM node:18

# Create app directory inside container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app source code
COPY . .

# Expose the port your app listens on (3001)
EXPOSE 3001

# Command to start your app
CMD ["node", "index.js"]
