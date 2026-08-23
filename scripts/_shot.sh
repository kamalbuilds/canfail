#!/usr/bin/env bash
# Screenshot helper. Runs a command, prints it as a prompt line, shows the real
# exit code, and always exits 0 so the capture tool does not treat a failing gate
# as a failed capture. canfail exits 1 on purpose; that is the point of the image.
printf '\033[2m$ %s\033[0m\n' "$1"
eval "$1"
code=$?
printf '\033[2m$ echo $?\033[0m\n%s\n' "$code"
exit 0
