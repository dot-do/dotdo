{{/*
Expand the name of the chart.
*/}}
{{- define "dotdo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "dotdo.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "dotdo.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "dotdo.labels" -}}
helm.sh/chart: {{ include "dotdo.chart" . }}
{{ include "dotdo.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dotdo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dotdo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "dotdo.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "dotdo.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "dotdo.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- include "dotdo.fullname" . }}-secrets
{{- end }}
{{- end }}

{{/*
Create the name of the configmap
*/}}
{{- define "dotdo.configMapName" -}}
{{- include "dotdo.fullname" . }}-config
{{- end }}

{{/*
Linkerd annotations
*/}}
{{- define "dotdo.linkerdAnnotations" -}}
{{- if .Values.linkerd.enabled }}
linkerd.io/inject: {{ .Values.linkerd.inject | default "enabled" }}
{{- if .Values.linkerd.mtls }}
config.linkerd.io/default-inbound-policy: all-authenticated
{{- end }}
{{- end }}
{{- end }}

{{/*
Common pod annotations including Linkerd
*/}}
{{- define "dotdo.podAnnotations" -}}
{{- with .Values.podAnnotations }}
{{- toYaml . }}
{{- end }}
{{- include "dotdo.linkerdAnnotations" . }}
{{- if .Values.prometheus.enabled }}
prometheus.io/scrape: "true"
prometheus.io/port: "{{ .Values.service.port }}"
prometheus.io/path: "/metrics"
{{- end }}
{{- end }}

{{/*
Return true if a secret should be created
*/}}
{{- define "dotdo.createSecret" -}}
{{- if and .Values.secrets.create (not .Values.secrets.existingSecret) }}
{{- true }}
{{- end }}
{{- end }}

{{/*
Return the image name
*/}}
{{- define "dotdo.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
