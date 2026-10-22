package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.events.MouseEvent;
   import flash.media.SoundMixer;
   import flash.media.SoundTransform;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol25")]
   public dynamic class music_4 extends MovieClip
   {
      
      public var music:Boolean;
      
      public function music_4()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      public function onClick(param1:*) : *
      {
         if(this.music)
         {
            this.music = false;
            SoundMixer.soundTransform = new SoundTransform(0);
            gotoAndStop(2);
         }
         else
         {
            this.music = true;
            SoundMixer.soundTransform = new SoundTransform(1);
            gotoAndStop(1);
         }
      }
      
      public function init() : *
      {
         if(SoundMixer.soundTransform.volume == 0)
         {
            this.music = false;
            gotoAndStop(2);
         }
      }
      
      internal function frame1() : *
      {
         stop();
         this.addEventListener(MouseEvent.CLICK,this.onClick);
         this.buttonMode = true;
         this.music = true;
         this.init();
      }
   }
}

