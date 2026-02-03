# Chiba Cable Pi Deployment (One-Stop)

This is the shortest path to deploy a Pi node over SSH **and** point it at the Chiba Cable guide.

## Prereqs

- You have the `chiba` repo locally (the controller + node stack).
- You have the `chiba-cable` stack running somewhere the Pi can reach.

## One-shot deploy + set kiosk URL

Copy/paste this on your machine (edit the values):

```bash
PI_HOST="mars01.local"                # pi host or IP
NODE_NAME="living-room"               # how it shows up in the dashboard
CONTROLLER_URL="http://192.168.1.10:8080"  # controller machine
GUIDE_URL="http://192.168.1.10:5173/?screenId=${NODE_NAME}"
API_KEY="your-api-key"
EDEN_KEY="your-eden-key"

# 1) Deploy the node onto the Pi
ssh "${PI_HOST}" "curl -sL \"https://raw.githubusercontent.com/mars-college/chiba/main/scripts/setup-node.sh?v=$(date +%s)\" | bash -s -- \
  --controller-url ${CONTROLLER_URL} \
  --node-name ${NODE_NAME} \
  --api-key \"${API_KEY}\" \
  --eden-key \"${EDEN_KEY}\""

# 2) Point the kiosk at Chiba Cable
curl -X POST "${PI_HOST}:8080/kiosk-url" -d "{\"url\":\"${GUIDE_URL}\"}"
```

## Notes

- `GUIDE_URL` should point to your **Chiba Cable guide UI** (default Vite dev port `5173`).
- If you’re serving the built guide from the cable server, use port `8787` instead.
- You can re-run just the kiosk command any time to switch displays:
  ```bash
  curl -X POST "PI_HOST:8080/kiosk-url" -d '{"url":"http://GUIDE_HOST:5173/?screenId=pi-01"}'
  ```
