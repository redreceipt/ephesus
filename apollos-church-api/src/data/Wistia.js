/* eslint-disable class-methods-use-this */
import { RESTDataSource } from 'apollo-datasource-rest';

class dataSource extends RESTDataSource {
  baseURL = 'https://lcbcchurch.wistia.com/embed/medias/';

  // willSendRequest = (request) => {};

  getHLSForVideo = async (id) => {
    // captures either vimeo/123 or 123
    const matches = id.match(/\/?(\w+)$/);
    if (matches && matches[1]) {
      const video = await this.get(`${matches[1]}.json`);
      return this.findHLSSource(video);
    }
    return null;
  };

  getImage = async (id) => {
    const matches = id.match(/\/?(\w+)$/);
    if (matches && matches[1]) {
      const video = await this.get(`${matches[1]}.json`);
      return this.findJPGSource(video);
    }
    return null;
  };

  findHLSSource({ media }) {
    const hls =
      media.assets.find(
        ({ type, width }) => type === 'hd_mp4_video' && width === 1920
      ) || media.assets.find(({ type }) => type === 'original');

    return hls ? `${hls.url.split('.bin')[0]}.m3u8?origin_v2=1` : null;
  }

  findJPGSource({ media }) {
    const jpg = media.assets.find(({ type }) => type === 'still_image');

    return jpg ? `${jpg.url.split('.bin')[0]}.jpeg` : null;
  }
}

export { dataSource };
