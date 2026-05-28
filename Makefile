NPM ?= npm

.DEFAULT_GOAL := check

.PHONY: install lint format typecheck test check api demo demo-approve console clean

install:
	$(NPM) install

lint:
	$(NPM) run lint

format:
	$(NPM) run format

typecheck:
	$(NPM) run typecheck

test:
	$(NPM) run test

check:
	$(NPM) run check

api:
	$(NPM) run api

demo:
	$(NPM) run demo

demo-approve:
	$(NPM) run demo-approve

console:
	$(NPM) run console

clean:
	rm -rf dist build coverage .turbo .tsbuildinfo
