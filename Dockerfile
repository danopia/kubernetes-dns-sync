FROM hayd/alpine-deno:1.10.1
WORKDIR /src/kubernetes-dns-sync

ADD deps.ts ./
RUN ["deno", "cache", "deps.ts"]

ADD . ./
RUN ["deno", "cache", "controller/mod.ts"]

ENTRYPOINT ["deno", "run", "--unstable", "--allow-hrtime", "--allow-net", "--allow-read", "--allow-env", "--cached-only", "--no-check", "controller/mod.ts"]
