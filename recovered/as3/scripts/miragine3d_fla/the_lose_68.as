package miragine3d_fla
{
   import flash.display.MovieClip;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol253")]
   public dynamic class the_lose_68 extends MovieClip
   {
      
      public var flag_lose:MovieClip;
      
      public function the_lose_68()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         addChild(new Flag(this.flag_lose));
      }
   }
}

