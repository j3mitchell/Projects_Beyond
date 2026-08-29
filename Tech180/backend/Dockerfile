FROM mcr.microsoft.com/playwright/python:v1.49.1-noble

WORKDIR /srv/tech180

# Install Python packages before copying the application so dependency layers
# can stay cached between ordinary code deployments.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app

ENV PYTHONUNBUFFERED=1
EXPOSE 10000

# Cloud Run supplies PORT. The fallback also makes the image easy to test locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
