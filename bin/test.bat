REM Runs the component tests inside the docker network. Start the stack first with bin\run.bat.
docker compose --profile test run --rm --build tests
