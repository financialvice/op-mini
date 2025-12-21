#!/bin/bash
# Fly.io WireGuard VPN for private network access
# Required to connect to Fly machines via their private IPv6 addresses

set -e

FLY_CONF="${FLY_WIREGUARD_CONF:-$HOME/.wireguard/fly.conf}"
FLY_ORG="${FLY_ORG:-personal}"
FLY_REGION="${FLY_REGION:-sjc}"
FLY_PEER_NAME="${FLY_PEER_NAME:-op-mini-local}"

usage() {
  echo "Usage: $0 <command>"
  echo ""
  echo "Commands:"
  echo "  up       Connect to Fly private network (requires sudo)"
  echo "  down     Disconnect from Fly private network (requires sudo)"
  echo "  status   Show WireGuard connection status"
  echo "  setup    Create WireGuard peer (one-time setup)"
  echo ""
  echo "Environment variables:"
  echo "  FLY_WIREGUARD_CONF  Path to WireGuard config (default: ~/.wireguard/fly.conf)"
  echo "  FLY_ORG             Fly organization (default: personal)"
  echo "  FLY_REGION          Fly region for peer (default: sjc)"
  echo "  FLY_PEER_NAME       Name for WireGuard peer (default: op-mini-local)"
  exit 1
}

case "${1:-}" in
  up)
    if [ ! -f "$FLY_CONF" ]; then
      echo "Error: WireGuard config not found at $FLY_CONF"
      echo "Run '$0 setup' first to create the peer"
      exit 1
    fi
    echo "Connecting to Fly private network..."
    sudo wg-quick up "$FLY_CONF"
    echo "Connected! You can now access Fly machines via their private IPs."
    ;;
  down)
    echo "Disconnecting from Fly private network..."
    sudo wg-quick down "$FLY_CONF"
    echo "Disconnected."
    ;;
  status)
    sudo wg show
    ;;
  setup)
    if [ -f "$FLY_CONF" ]; then
      echo "WireGuard config already exists at $FLY_CONF"
      echo "Delete it first if you want to recreate the peer."
      exit 1
    fi
    mkdir -p "$(dirname "$FLY_CONF")"
    echo "Creating WireGuard peer..."
    flyctl wireguard create "$FLY_ORG" "$FLY_REGION" "$FLY_PEER_NAME" "$FLY_CONF"
    echo ""
    echo "Peer created! Config saved to $FLY_CONF"
    echo "Run '$0 up' to connect."
    ;;
  *)
    usage
    ;;
esac
