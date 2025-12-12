{{- define "flip7-multiplayer.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "flip7-multiplayer.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "flip7-multiplayer.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "flip7-multiplayer.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- if .Values.serviceAccount.name -}}
{{- .Values.serviceAccount.name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "flip7-multiplayer.fullname" . -}}
{{- end -}}
{{- else -}}
{{- "default" -}}
{{- end -}}
{{- end -}}
