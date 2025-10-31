# Use AWS Lambda Node.js 20 base image
FROM public.ecr.aws/lambda/nodejs:20

# Install system dependencies required for building native modules
# - tar, xz: Required for extracting source archives
# - gcc-c++, make, cmake: Build tools
# - autoconf, automake, libtool: Required for generating configure scripts
# - libpng-devel: PNG support
# - libjpeg-turbo-devel: JPEG support
# - libwebp-devel: WebP support
# - giflib-devel: GIF support
# - libde265-devel: HEVC decoder (required for HEIC)
# - glib2-devel, expat-devel: Required by libvips
RUN dnf install -y \
    tar \
    xz \
    gcc-c++ \
    make \
    cmake \
    autoconf \
    automake \
    libtool \
    libpng-devel \
    libjpeg-turbo-devel \
    libwebp-devel \
    giflib-devel \
    libde265-devel \
    glib2-devel \
    expat-devel \
    && dnf clean all

# Install libheif from source for HEIC/HEIF support
# Version 1.19.5 is latest stable with security fixes (Jan 2025)
# Uses CMake build system (not autoconf)
RUN curl -L https://github.com/strukturag/libheif/releases/download/v1.19.5/libheif-1.19.5.tar.gz \
    | tar xz && \
    cd libheif-1.19.5 && \
    mkdir build && cd build && \
    cmake --preset=release .. && \
    make -j$(nproc) && \
    make install && \
    cd ../.. && \
    rm -rf libheif-1.19.5

# NOTE: We skip building libvips separately because Sharp comes with its own
# pre-built libvips binaries that include all necessary format support including HEIC
# This is much faster and more reliable than building from source

# Copy package files first (for better Docker layer caching)
COPY package*.json ${LAMBDA_TASK_ROOT}/

# Install Node.js dependencies
# Sharp will use our custom-built libheif for HEIC support
# Using --production to install only production dependencies
RUN npm install --production

# Copy Lambda function code
COPY index.js ${LAMBDA_TASK_ROOT}/

# Set the CMD to your handler
CMD ["index.handler"]

