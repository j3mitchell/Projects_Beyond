FROM mcr.microsoft.com/playwright/python:v1.49.1-noble
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RESUMEATS_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends antiword fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && python -m spacy download en_core_web_sm
COPY backend/app ./app
# Cache public occupational data at build time, never during the first upload.
RUN python -c "from app.classifier import classifier; classifier.ensure_onet_loaded(); assert classifier.status()['onet_titles'] > 0, classifier.status()"
RUN useradd --create-home resumeats && chown -R resumeats:resumeats /app
USER resumeats
CMD ["sh", "-c", "exec uvicorn app.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
