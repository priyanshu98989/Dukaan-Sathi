# MongoDB for Dukaan Sathi, as a Render *private* service.
#
# A private service has no onrender.com subdomain and no public IP: the only way
# to reach it is from another service in the same workspace and region, over
# Render's private network. That is what replaces MongoDB Atlas here - the
# database is never exposed to the internet, so there is no IP allowlist to
# widen to 0.0.0.0/0 and no username/password to leak.
#
# `mongo:8` rather than the `mongo:4.2` in Render's own example template: 4.2 has
# been end-of-life since April 2023, and Mongoose 9 targets a supported server.
# Mongoose 9 is compatible with MongoDB 8.x.
#
# No auth is configured, which is the same posture Render's template takes and is
# safe *because* the service is unreachable from outside Render. If you ever
# expose this port publicly, enable auth first.
FROM mongo:8
