# Build only from the allowlisted context produced by deploy/k3s/package.py.
FROM nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284
COPY nginx.conf /etc/nginx/nginx.conf
COPY site/ /usr/share/nginx/html/trans-resilience/
USER 101:101
EXPOSE 8080
ENTRYPOINT ["nginx", "-g", "daemon off;"]
