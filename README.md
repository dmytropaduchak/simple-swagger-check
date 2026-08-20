# simple-swagger-check

Compares OpenAPI/Swagger specs between the PR base and head and reports **breaking** removals (paths/methods).

## Usage

```yaml
- uses: actions/checkout@v4
- uses: dmytropaduchak/simple-swagger-check@v0.1.0
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Develop

```bash
npm install && npm run build
```
