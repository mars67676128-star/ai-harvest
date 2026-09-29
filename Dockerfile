FROM python:3.14-slim
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY harvest ./harvest
RUN useradd --create-home harvest && mkdir /app/data && chown harvest:harvest /app/data
USER harvest
ENV HARVEST_DB=/app/data/harvest.db
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "harvest.main:app", "--host", "0.0.0.0", "--port", "8000"]
