FROM ubuntu:latest

ARG DEBIAN_FRONTEND=noninteractive

RUN echo "==> Upgrading apk and installing system utilities ...." \
 && apt -y update \
 && apt-get install -y wget \
 && apt-get -y install sudo

RUN echo "==> Installing Python3, pip, and SSH client ...." \  
  && apt-get update && apt-get install -y --fix-missing python3 python3-pip openssh-client

RUN echo "==> Install langchain requirements.." \
  && pip install --break-system-packages -U --quiet langchain_experimental langchain langchain-community langchain_google_genai langchain_openai

RUN echo "==> Adding dotenv ..." \
  && pip install --break-system-packages python-dotenv

RUN echo "==> Install langgraph and required components" \
  && pip install --break-system-packages google-generativeai \
  && pip install --break-system-packages --upgrade "protobuf>=6.31.0" \
  && pip install --break-system-packages --upgrade "langgraph-cli[inmem]" \
  && pip install --break-system-packages --upgrade "langgraph>=0.0.30" \
  && pip install --break-system-packages langsmith \
  && pip install --break-system-packages fastapi \
  && pip install --break-system-packages mcp

RUN echo "==> Installing Docker CLI" \
  && apt-get update \
  && apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
RUN apt-get update && apt-get install -y docker-ce-cli

RUN pip install --break-system-packages --upgrade langgraph

RUN echo "==> Installing pyATS and genie dependencies..." \
  && pip install --break-system-packages pyats \
  && pip install --break-system-packages genie \
  && pip install --break-system-packages unicon \
  && pip install --break-system-packages genie.libs.parser

COPY . /selectorplus/

COPY ./scripts /scripts/

CMD ["/bin/bash", "/scripts/startup.sh"]