FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied (if available)
COPY package*.json ./

RUN npm install --production

# Bundle app source
COPY . .

# Ensure data and uploads directories exist inside the container context
# Volumes will override these, but it prevents early errors
RUN mkdir -p data uploads

EXPOSE 3000

# Start command
CMD [ "node", "src/index.js" ]
