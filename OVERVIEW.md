Open the Devbox panel in a Paseo workspace to see the development services
associated with that checkout. Copy a preview or editor command for the
Devbox client on the computer where you want to open it.

The plugin supports Paseo 0.16.1 through the 0.16 series. Configure a trusted
Devbox connection on the computer that will run the copied commands. Detecting
additional listeners and opening an exact checkout in another editor require
the Devbox workspace helper and coverage of that checkout in its inventory.

The plugin reads the selected workspace's metadata and its matching service
observations through the existing Paseo connection. It does not change
workspaces, start or stop services, create port forwards, request credentials,
or send telemetry. A detected service may still need a private forward from
your local Devbox client.
