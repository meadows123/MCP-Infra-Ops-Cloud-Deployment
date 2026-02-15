FROM python:3.11-slim

WORKDIR /app

RUN pip install requests
RUN pip install python-dotenv
RUN pip install fastapi
RUN pip install uvicorn
RUN apt-get update && apt-get install -y curl

# Copy servicenow directory contents
COPY . .

EXPOSE 3000

CMD ["python", "-u", "http_server.py"]

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s \
  CMD curl -f http://localhost:3000/health || exit 1