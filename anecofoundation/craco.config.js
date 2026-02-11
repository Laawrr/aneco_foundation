module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Suppress source map warnings for html2pdf.js
      webpackConfig.ignoreWarnings = [
        ...(webpackConfig.ignoreWarnings || []),
        {
          module: /html2pdf\.js/,
          message: /Failed to parse source map/,
        },
      ];
      return webpackConfig;
    },
  },
};



