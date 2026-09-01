# Security & Privacy Documentation

This document outlines the security architecture, encryption standards, data privacy model, and device protection mechanisms implemented in **Nobar**.

---

## 1. Overview

Nobar is designed with a **privacy-first, zero-unauthorized-access** architecture. It leverages native WebRTC protocols and modern web standards to provide real-time peer-to-peer audio, video, and screen sharing without ever exposing or accessing participants' private device data, files, or local systems.

---

## 2. Browser Sandbox & Hardware Isolation

### No Access to Local Files or OS Data
WebRTC and web applications run inside the browser's **Security Sandbox** (Chrome, Safari, Edge, Firefox, etc.). 
- **No File Access**: The application cannot access, read, scan, or modify any files on your computer or mobile device (no access to documents, photo galleries, downloads, or operating system files).
- **No Device Identifiers**: The application cannot access device serial numbers, MAC addresses, IMEI, contacts, or personal accounts.
- **Hardware Isolation**: The application interacts only with media devices through standard W3C Web APIs (`navigator.mediaDevices.getUserMedia` and `navigator.mediaDevices.getDisplayMedia`).

### Explicit User Consent & Permissions
- **Camera & Microphone**: Browsers require explicit user consent before any media stream can be captured. The user can mute/unmute or disable the camera at any moment.
- **Screen Sharing**: When screen sharing, the browser's native OS dialog allows the host to explicitly choose whether to share a specific application window, a browser tab, or the entire screen. The application cannot capture anything beyond what the user explicitly selects.

---

## 3. End-to-End Media Encryption (DTLS-SRTP)

All audio and video streams in Nobar are encrypted by default in transit across the network using standardized cryptographic protocols mandated by the IETF WebRTC specification:

```
+---------------+                                   +---------------+
|  Participant  | <======= DTLS-SRTP Encrypted ======> |  Participant  |
|   (Client A)  |         Audio / Video Stream      |   (Client B)  |
+---------------+                                   +---------------+
```

1. **DTLS (Datagram Transport Layer Security)**:
   - Used during the initial connection handshake to perform mutual authentication and negotiate cryptographic session keys directly between peers.
2. **SRTP (Secure Real-time Transport Protocol)**:
   - Encrypts all real-time audio and video packets using AES-128/AES-256 cipher suites with message authentication (HMAC-SHA1).
3. **Zero Interception / Eavesdropping**:
   - Intermediate network hops, ISPs, and even relay servers (TURN server / reverse proxy) **cannot decrypt, view, or record** the audio and video streams because the encryption keys are negotiated directly between the participating endpoints.

---

## 4. Data Privacy: What Is & Isn't Exchanged

### Data Transmitted During a Call:
| Data Element | Purpose | Storage |
|---|---|---|
| `displayName` | Display name entered by the user on the join screen | Ephemeral in memory during the call |
| `userId` | Randomly generated temporary identifier | Session memory, expires with room |
| `roomCode` | 6-character room identifier | Temporary in Redis with TTL auto-expiration |
| **SDP / ICE Candidates** | Network routing data to establish peer connection | Exchanged during handshake, not stored |
| **Media Streams** | Real-time audio, video, and screen capture | Streamed directly peer-to-peer, never saved |
| **Chat Messages** | Ephemeral real-time text chat in room | Broadcast to room members, not persisted to database |

### Data NEVER Collected or Accessed:
- ❌ Hard drive / storage / files / photos
- ❌ Contact lists / email accounts
- ❌ Device MAC addresses / IMEI / hardware serials
- ❌ Browsing history / background applications
- ❌ Location coordinates / GPS data

---

## 5. Application & Backend Security

### JSON Web Token (JWT) Authentication
- All signaling actions require a cryptographically signed JWT token (`HS256`).
- Tokens are bound to a specific `roomCode` and `userId` with a short expiration TTL.
- Unauthorized users without a valid token cannot join or intercept room events.

### Strict Room Isolation
- The signaling server verifies membership (`isRoomMember`) for every socket event.
- Signals (offers, answers, ICE candidates, chat, reactions) are strictly routed only to sockets verified to be in the same room.

### Ephemeral State & Auto-Cleanup (TTL)
- Room metadata in Redis is governed by a strict Time-To-Live (`ROOM_TTL_SECONDS`).
- When a room is closed or times out, all associated session keys and records are automatically purged from memory.

### HTTP Security Headers & Transport Security
- **HTTPS / TLS**: All web assets and API endpoints are served over TLS (HTTPS/WSS) via automated certificate management (Caddy / Let's Encrypt).
- **Helmet**: Secures Express HTTP headers against clickjacking, cross-site scripting (XSS), MIME-sniffing, and injection attacks.
- **CORS Protection**: Origin access is strictly validated against configured domains.

---

## 6. TURN Relay Security (Coturn)

- **Time-Limited Ephemeral Credentials**: TURN credentials use HMAC-SHA1 shared secrets generated dynamically per user with a short lifespan.
- **No Loopback / No Multicast**: Configured with `no-loopback-peers` and `no-multicast-peers` to prevent internal network scanning or relay misuse.
- **Relay-Only Traffic**: Coturn acts strictly as an encrypted UDP/TCP packet router when direct P2P connections are blocked by NAT/firewalls; it does not decrypt the SRTP payload.

---

## 7. Compliance & Comparison

Nobar follows the exact same security, encryption, and permission models used by industry-leading conferencing platforms:

| Security Feature | Nobar | Google Meet | Zoom (Web) | Discord (Web) |
|---|:---:|:---:|:---:|:---:|
| **Browser Sandbox Isolation** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **DTLS-SRTP Media Encryption** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **No File System Access** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Explicit Permission Prompts** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Ephemeral Session Storage** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **No Account / Tracking Required** | ✅ Yes | ❌ No | ❌ No | ❌ No |

---

## 8. Summary

Joining a room in Nobar is completely safe. The application functions solely as an in-browser media stream participant. It has zero capability or permissions to access external device files, background programs, or sensitive personal data.
