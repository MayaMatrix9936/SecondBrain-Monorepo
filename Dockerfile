# Root Dockerfile for DigitalOcean detection
# This file helps DigitalOcean detect the project
# Actual services are defined in app.yaml

FROM node:20-alpine
WORKDIR /app
RUN echo "SecondBrain Monorepo - Use app.yaml for deployment"

