# Built from the repository root: the tests import source from both app/ and pipeline/,
# so each package's dependencies are installed next to where its source is mounted.
FROM node:20.17.0-alpine

WORKDIR /usr/src

COPY app/package.json app/package-lock.json app/
COPY pipeline/package.json pipeline/package-lock.json pipeline/
COPY tests/package.json tests/package-lock.json tests/

RUN cd app && npm clean-install \
 && cd ../pipeline && npm clean-install \
 && cd ../tests && npm clean-install

WORKDIR /usr/src/tests

CMD ["npm", "test"]
